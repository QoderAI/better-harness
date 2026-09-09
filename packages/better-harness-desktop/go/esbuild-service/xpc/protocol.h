#import <Foundation/Foundation.h>

// This is NSXPC's Objective-C protocol, not the low-level xpc_dictionary API.
@protocol HarnessEsbuildProtocol
- (void)performRequest:(NSData *)request reply:(void (^)(NSData *))reply;
@end

static NSString *const HarnessEsbuildServiceID = @"com.qoder.harness-studio.esbuild";
static const NSUInteger HarnessEsbuildMaxFrame = 64 * 1024 * 1024;
