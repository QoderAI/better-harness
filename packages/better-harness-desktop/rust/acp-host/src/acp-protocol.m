// ABI metadata only: every listener, service and bridge behaviour is Rust.
// Clang emits the extended block/selector argument encodings NSXPCInterface
// inspects at runtime; the Rust side implements the methods declared here.
//
// Unlike the OXC service (one NSData request/reply method), ACP is a long-lived
// bidirectional stream: the bridge pushes stdin lines to the service with
// `sendFrame:` and the service pushes replies *and* unsolicited events back with
// `deliverFrame:`. Each NSData is exactly one newline-terminated JSON line of the
// existing `wire` contract, so nothing in the Rust host driver changes.
#import <Foundation/Foundation.h>

@protocol HarnessAcpHostProtocol
- (void)sendFrame:(NSData *)frame;
@end

@protocol HarnessAcpClientProtocol
- (void)deliverFrame:(NSData *)frame;
- (void)hostFailed:(NSString *)reason;
@end

Protocol *harness_acp_host_protocol(void) { return @protocol(HarnessAcpHostProtocol); }
Protocol *harness_acp_client_protocol(void) { return @protocol(HarnessAcpClientProtocol); }
