package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"github.com/QoderAI/better-harness/esbuild-service/linker"
	"unsafe"
)

// HarnessEsbuild copies incoming bytes and returns a C allocation. The caller
// owns the returned bytes and must free them; no Go pointer crosses this ABI.
//
//export HarnessEsbuild
func HarnessEsbuild(data unsafe.Pointer, length C.size_t, outputLength *C.size_t) unsafe.Pointer {
	if length > linker.MaxFrame {
		return nil
	}
	result := linker.Handle(C.GoBytes(data, C.int(length)))
	*outputLength = C.size_t(len(result))
	return C.CBytes(result)
}

func main() {}
