# Support & Help Center
Welcome to the support page for the CALC Translation App. This application is an internal tool for the CALC organization or its subsidiaries staff to provide real-time translation and transcription during Zoom meetings.

## What does this app do?

This system works in two parts:

- **For Meeting Hosts:** A Zoom App integration, which must be installed by the meeting host, securely captures the meeting's audio and sends it to our internal servers for processing.

- **For Meeting Participants (Viewers):** A separate Web App and Desktop App where participants can log in to view the live translation and transcription feed for their meeting.

An end-user or participant only needs to visit the web URL or use the desktop application to view the feed. Only the meeting host interacts with the Zoom App integration.

## Getting Started: For Meeting Participants (Viewers)

**Option 1: View via Web Browser (Recommended)**

This is the simplest method and requires no installation.

1. **Open your web browser (e.g., Chrome, Edge).**

2. **Navigate to the web application URL**

3. **Authenticate using your company credentials.**

4. **Once logged in, you may have to provide the meetingID or password to join**

**Option 2: View via Desktop Application**

1.  **Go to Releases:** Click [**HERE**](https://github.com/jcarpenter-uam/calc-translation-desktop/releases/latest).
2.  **Download:** On that page, find the **Assets** section and click the file named `CALC-Translation-Setup-VERSION.exe` to download it.
3.  **Run Installer:** Once downloaded, open the `.exe` file to begin the installation.
4.  **Approve Install:** Click **Yes** when Windows asks for permission to make changes.
5.  **Follow the same authentication steps as the web version**

> [!NOTE]
> **Windows Protected Your PC?**
>
> You may see a blue "Windows protected your PC" screen. This is expected.
>
> 1.  Click the small text that says **"More info"**.
> 2.  A new button, **"Run anyway"**, will appear. Click it.
>
> *This warning appears simply because the app is not registered with Microsoft (a costly process). It is safe to install if downloaded directly from this GitHub repository or distributed throughout the organization.*

## Getting Started: For Meeting Hosts (Sending Audio)

As the host, you are responsible for sending the meeting's audio to the translation service.

- **Authorize App:** Ensure the CALC Translation App (the app from the Zoom Marketplace, not the desktop app) is installed and authorized for your Zoom account. Contact your IT Administrator if you need this set up.

- **Start Meeting:** Start your Zoom meeting as the host.

- **Run App:** Open the app within your Zoom client. This action begins the secure audio stream to our servers.

- **Confirm:** Inform your participants that the feed is now live and they can view it on the web or desktop application.

# Frequently Asked Questions (FAQ)
**Q: (As a Viewer) The translation feed is blank or not updating. What should I do?**

- First, try refreshing the web page or restarting the desktop application. If it's still not working, the meeting host may not have started the audio feed from their end. Please notify the host that the feed is not active.

**Q: (As a Host) Participants say the translation is not appearing. What should I do?**

- First, check that the CALC Translation App is open and active in your Zoom meeting. Second, try pausing or stopping the Zoom app temporarily. If it's still not working, try leaving the meeting and rejoining.

**Q: As a participant (viewer), do I need to install anything in Zoom?**

- No. You only need to access the web URL or use the optional desktop viewing application. Only the meeting host installs an app within Zoom.

**Q: The translation is inaccurate or has errors.**

- The app uses an advanced AI service (Soniox) for translation, but it is not perfect. Accuracy can be affected by:

- Poor audio quality, Significant background noise in the meeting, Multiple people speaking at once, Very fast or unclear speech

**Q: I can't find the transcript from my last meeting.**

- Only users who attended a specific meeting can access its stored transcript. If you attended the meeting and still cannot find the transcript, please contact your IT administrator for assistance with access rights.

**Q: Who can see the live translation?**

- The real-time transcription and translation feed is visible to all authenticated meeting participants using the web or desktop application.

**Q: Who can access the stored transcript after the meeting?**

- Access is restricted to users who attended the meeting. Please handle all transcripts as confidential company information, in line with our internal data policies.

# How to Get Direct Support
If the FAQ above does not solve your problem, we are here to help.

For Technical Support, Bug Reports, or Feature Questions:
Please contact the application developer directly:

- Contact: Jonah Carpenter

- Method: Please use the internal company directory to find Jonah's email or on teams.

When reporting a bug, please include as much detail as possible:

- The date and time the issue occurred

- The Zoom Meeting ID (if possible)

- A brief description of what happened

For Installation, Access, or Policy Questions:
For issues related to installing the app, getting authorization for your Zoom account, or accessing specific meeting transcripts, please contact:

- Contact: Your internal IT Administrator
