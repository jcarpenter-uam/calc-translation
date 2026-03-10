.PHONY: server-test-gates server-ttft-test server-ttft-live server-prod-coverage-100

server-test-gates:
	cd server && ./venv/bin/python -m pytest -q -c pytest.ini
	cd server && ./venv/bin/python -m pytest -q -c pytest-services.ini --cov=services --cov-report=term-missing

server-ttft-test:
	cd server && ./venv/bin/python -m pytest -q -s -o addopts='' \
		tests/test_api_transcribe.py::test_transcribe_ttft_from_audio_to_first_soniox_token

server-ttft-live:
	cd server && RUN_LIVE_SONIOX_TTFT=1 ./venv/bin/python -m pytest -q -s -o addopts='' \
		tests/test_api_transcribe.py::test_transcribe_ttft_live_soniox

server-prod-coverage-100:
	$(MAKE) server-ttft-test
	cd server && ./venv/bin/python -m pytest -q -o addopts='' \
		--cov=api \
		--cov=core \
		--cov=integrations \
		--cov=main \
		--cov=models \
		--cov=services \
		--cov-report=term-missing \
		--cov-fail-under=100
