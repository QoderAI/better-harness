// ABI metadata only: all client, listener and extraction behavior is Rust.
// Clang emits extended block argument encodings required by NSXPCInterface.
#import <Foundation/Foundation.h>
@protocol HarnessOntologyProtocol
- (void)performRequest:(NSData *)request reply:(void (^)(NSData *))reply;
@end
Protocol *harness_ontology_protocol(void) { return @protocol(HarnessOntologyProtocol); }
