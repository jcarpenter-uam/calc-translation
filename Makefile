.PHONY: server-test-gates server-prod-coverage-100

server-test-gates:
	cd server && ./venv/bin/python -m pytest -q -c pytest.ini
	cd server && ./venv/bin/python -m pytest -q -c pytest-services.ini --cov=services --cov-report=term-missing

server-prod-coverage-100:
	cd server && ./venv/bin/python -m pytest -q -o addopts='' \
		--cov=api \
		--cov=core \
		--cov=integrations \
		--cov=main \
		--cov=models \
		--cov=services \
		--cov-report=term-missing \
		--cov-fail-under=100
