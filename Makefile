# make        build the calculator app template and the website
# make dev    run the website locally
# make test   run all tests

.PHONY: all viewer web dev test clean

all: web

viewer:
	$(MAKE) -C viewer install-web

web: viewer
	cd web && npm ci && npm run build

dev: viewer
	cd web && npm run dev

test: viewer
	cd web && npm test
	$(MAKE) -C viewer test

clean:
	$(MAKE) -C viewer clean
	rm -rf web/dist web/public/viewer
