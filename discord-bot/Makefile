ROOT_MAKEFILE := $(firstword $(wildcard /workspace/Makefile ../Makefile))

ifeq ($(ROOT_MAKEFILE),)
$(error Could not find the root Makefile)
endif

include $(ROOT_MAKEFILE)
