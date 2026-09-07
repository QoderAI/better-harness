// ABI metadata only: all client, listener and compiler behavior is Rust.
// Clang emits extended block argument encodings required by NSXPCInterface.
#import <Foundation/Foundation.h>
@protocol HarnessOxcProtocol
- (void)performRequest:(NSData *)request reply:(void (^)(NSData *))reply;
@end
Protocol *harness_oxc_protocol(void) { return @protocol(HarnessOxcProtocol); }
