# Command to create the virtual audio sink

```bash
pactl load-module module-null-sink sink_name=virtual_sink sink_properties=device.description="Virtual_Sink_for_Transcription" rate=16000 format=s16le channels=1
```
