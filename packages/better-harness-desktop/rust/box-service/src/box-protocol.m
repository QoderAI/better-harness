// ABI metadata only: every listener, service and bridge behaviour is Rust.
#import <Foundation/Foundation.h>

@protocol HarnessBoxHostProtocol
- (void)sendFrame:(NSData *)frame;
@end

@protocol HarnessBoxClientProtocol
- (void)deliverFrame:(NSData *)frame;
- (void)hostFailed:(NSString *)reason;
@end

Protocol *harness_box_host_protocol(void) { return @protocol(HarnessBoxHostProtocol); }
Protocol *harness_box_client_protocol(void) { return @protocol(HarnessBoxClientProtocol); }
