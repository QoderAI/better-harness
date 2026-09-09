#import "protocol.h"
#include <stdio.h>
#include <unistd.h>

// stdio buffering keeps reads efficient while admitting no unbounded getline.
static NSData *readFrame(BOOL *invalid) {
    NSMutableData *frame = [NSMutableData data];
    unsigned char chunk[8192];
    size_t used = 0;
    int byte;
    while ((byte = fgetc(stdin)) != EOF) {
        if (byte == '\n') {
            [frame appendBytes:chunk length:used];
            return frame;
        }
        chunk[used++] = (unsigned char)byte;
        if (frame.length + used > HarnessEsbuildMaxFrame) { *invalid = YES; return nil; }
        if (used == sizeof(chunk)) { [frame appendBytes:chunk length:used]; used = 0; }
    }
    *invalid = ferror(stdin) || frame.length > 0 || used > 0;
    return nil;
}

int main(void) {
    @autoreleasepool {
        NSXPCConnection *connection = [[NSXPCConnection alloc] initWithServiceName:HarnessEsbuildServiceID];
        connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(HarnessEsbuildProtocol)];
        [connection resume];
        for (;;) {
            @autoreleasepool {
                BOOL invalid = NO;
                NSData *frame = readFrame(&invalid);
                if (!frame) { [connection invalidate]; return invalid ? 1 : 0; }
                dispatch_semaphore_t completed = dispatch_semaphore_create(0);
                __block NSData *response;
                id<HarnessEsbuildProtocol> proxy = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) {
                    dispatch_semaphore_signal(completed);
                }];
                [proxy performRequest:frame reply:^(NSData *data) {
                    if (data.length <= HarnessEsbuildMaxFrame) response = data;
                    dispatch_semaphore_signal(completed);
                }];
                if (dispatch_semaphore_wait(completed, dispatch_time(DISPATCH_TIME_NOW, 35 * NSEC_PER_SEC)) != 0) {
                    [connection invalidate]; return 1;
                }
                NSMutableDictionary *value = response
                    ? [NSJSONSerialization JSONObjectWithData:response options:NSJSONReadingMutableContainers error:nil] : nil;
                if (![value isKindOfClass:[NSMutableDictionary class]] ||
                    ![value[@"pid"] isKindOfClass:[NSNumber class]] ||
                    connection.processIdentifier <= 0 || [value[@"pid"] intValue] != connection.processIdentifier) {
                    [connection invalidate]; return 1;
                }
                value[@"transport"] = @"nsxpc";
                value[@"bridgePid"] = @(getpid());
                NSData *encoded = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
                if (!encoded || encoded.length > HarnessEsbuildMaxFrame ||
                    fwrite(encoded.bytes, 1, encoded.length, stdout) != encoded.length ||
                    fputc('\n', stdout) == EOF || fflush(stdout) != 0) {
                    [connection invalidate]; return 1;
                }
            }
        }
    }
}
