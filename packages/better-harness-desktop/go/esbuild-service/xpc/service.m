#import "protocol.h"
#import "libharness_esbuild.h"
#include <stdatomic.h>
#include <unistd.h>

static dispatch_queue_t compilerQueue;
static atomic_uint pending;

@interface HarnessEsbuildService : NSObject <HarnessEsbuildProtocol>
@end
@implementation HarnessEsbuildService
- (void)performRequest:(NSData *)request reply:(void (^)(NSData *))reply {
    if (request.length > HarnessEsbuildMaxFrame) { reply([NSData data]); return; }
    if (atomic_fetch_add(&pending, 1) >= 16) {
        atomic_fetch_sub(&pending, 1);
        reply([NSData data]);
        return;
    }
    dispatch_async(compilerQueue, ^{
        @autoreleasepool {
            // A lost client cannot interrupt synchronous Go Build. launchd owns
            // service restart; this deadline is independent of the Node bridge.
            dispatch_source_t watchdog = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
                dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
            dispatch_source_set_timer(watchdog, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), DISPATCH_TIME_FOREVER, 0);
            dispatch_source_set_event_handler(watchdog, ^{ _exit(70); });
            dispatch_resume(watchdog);
            size_t length = 0;
            void *bytes = HarnessEsbuild((void *)request.bytes, request.length, &length);
            NSData *response = bytes && length <= HarnessEsbuildMaxFrame
                ? [NSData dataWithBytes:bytes length:length] : [NSData data];
            free(bytes);
            dispatch_source_cancel(watchdog);
            atomic_fetch_sub(&pending, 1);
            reply(response);
        }
    });
}
@end

@interface HarnessEsbuildDelegate : NSObject <NSXPCListenerDelegate>
@end
@implementation HarnessEsbuildDelegate
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(HarnessEsbuildProtocol)];
    connection.exportedObject = [HarnessEsbuildService new];
    [connection resume];
    return YES;
}
@end

int main(void) {
    @autoreleasepool {
        compilerQueue = dispatch_queue_create("com.qoder.harness-studio.esbuild.compiler", DISPATCH_QUEUE_SERIAL);
        HarnessEsbuildDelegate *delegate = [HarnessEsbuildDelegate new];
        NSXPCListener *listener = [NSXPCListener serviceListener];
        listener.delegate = delegate;
        [listener resume];
    }
    return 0;
}
