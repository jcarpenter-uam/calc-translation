import importlib

import pytest


def test_config_module_fatal_settings_load_path(monkeypatch):
    import core.config as config
    import pydantic_settings

    original_init = pydantic_settings.BaseSettings.__init__

    def bad_init(self, *args, **kwargs):
        raise RuntimeError("settings-fail")

    monkeypatch.setattr(pydantic_settings.BaseSettings, "__init__", bad_init)
    try:
        with pytest.raises(SystemExit):
            importlib.reload(config)
    finally:
        monkeypatch.setattr(pydantic_settings.BaseSettings, "__init__", original_init)
        importlib.reload(config)


def test_authentication_module_fernet_init_failure_path(monkeypatch):
    import core.authentication as authentication
    import core.config as config

    original_key = config.settings.ENCRYPTION_KEY
    monkeypatch.setattr(config.settings, "ENCRYPTION_KEY", "bad-key")
    try:
        with pytest.raises(Exception):
            importlib.reload(authentication)
    finally:
        monkeypatch.setattr(config.settings, "ENCRYPTION_KEY", original_key)
        importlib.reload(authentication)
