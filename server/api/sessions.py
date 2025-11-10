# /api/session/{integration}/{id}/downloads || json array of all the audio files and vtt transcript per meeting

# {
#   "session_id": "85912345678",
#   "integration": "zoom",
#   "downloads": {
#     "vtt": "path-to-download/transcript.vtt",
#     "audio_full_meeting": "path-to-download/meeting.m4a",
#     "audio_by_user": [
#       {
#         "speaker": "Alice",
#         "url": "path-to-download/alice.m4a"
#       },
#       {
#         "speaker": "Bob",
#         "url": "path-to-download/bob.m4a"
#       }
#     ]
#   }
# }
