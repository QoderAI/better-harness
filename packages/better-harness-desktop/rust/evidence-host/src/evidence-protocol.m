// ABI metadata only: every listener, service and bridge behaviour is Rust.
#import <Foundation/Foundation.h>

@protocol HarnessEvidenceHostProtocol
- (void)sendFrame:(NSData *)frame;
@end

@protocol HarnessEvidenceClientProtocol
- (void)deliverFrame:(NSData *)frame;
- (void)hostFailed:(NSString *)reason;
@end

Protocol *harness_evidence_host_protocol(void) { return @protocol(HarnessEvidenceHostProtocol); }
Protocol *harness_evidence_client_protocol(void) { return @protocol(HarnessEvidenceClientProtocol); }
