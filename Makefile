.PHONY: clean start-demo-server show-help rebuild-examples perform-tests

show-help:
	@echo "\
clean:              Flush all images generated by regression tests\n\
start-demo-server:  Start demo server\n\
show-help:          Show this help message\n\
rebuild-examples:   Rebuild example pages\n\
perform-tests:      Run tests"

clean:
	@rm test/images/*/*.png

start-demo-server:
	@npm run start-demo-server

rebuild-examples:
	@npm run rebuild-examples

perform-tests:
	@npm run test
