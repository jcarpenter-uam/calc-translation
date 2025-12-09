import { Link } from "react-router-dom";
import Header from "../components/header/header";
import Footer from "../components/misc/footer";
import ThemeToggle from "../components/header/theme-toggle.jsx";
import Language from "../components/header/language.jsx";

export default function Support() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <ThemeToggle />
        <Language />
      </Header>

      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          <Link
            to="/"
            className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
          >
            &larr; Back to Home
          </Link>
          <article className="prose dark:prose-invert lg:prose-xl">
            <h1>Support & Help Center</h1>
            <p>
              Welcome to the support page for the CALC Translation App. This
              application is an internal tool for the CALC organization or its
              subsidiaries staff to provide real-time translation and
              transcription during Zoom meetings.
            </p>

            <h2>What does this app do?</h2>
            <p>This system works in two parts:</p>
            <ul>
              <li>
                <span className="font-semibold">For Meeting Hosts:</span> A Zoom
                App integration, which must be installed by the meeting host,
                securely captures the meeting's audio and sends it to our
                internal servers for processing.
              </li>
              <li>
                <span className="font-semibold">
                  For Meeting Participants (Viewers):
                </span>{" "}
                A separate Web App and Desktop App where participants can log in
                to view the live translation and transcription feed for their
                meeting.
              </li>
            </ul>
            <p>
              An end-user or participant only needs to visit the web URL or use
              the desktop application to view the feed. Only the meeting host
              interacts with the Zoom App integration.
            </p>

            <h2>Getting Started: For Meeting Participants (Viewers)</h2>
            <span className="font-semibold">
              Option 1: View via Web Browser (Recommended)
            </span>
            <p>This is the simplest method and requires no installation.</p>
            <ol>
              <li>Open your web browser (e.g., Chrome, Edge).</li>
              <li>Navigate to the web application URL</li>
              <li>Authenticate using your company credentials.</li>
              <li>
                Once logged in, you may have to provide the meetingID or
                password to join
              </li>
            </ol>

            <span className="font-semibold">
              Option 2: View via Desktop Application
            </span>
            <ol>
              <li>
                <span className="font-semibold">Go to Releases:</span> Click{" "}
                <a
                  href="https://github.com/jcarpenter-uam/calc-translation-desktop/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  HERE
                </a>
                .
              </li>
              <li>
                <span className="font-semibold">Download:</span> On that page,
                find the <span className="font-semibold">Assets</span> section
                and click the file named{" "}
                <code>CALC-Translation-Setup-VERSION.exe</code> to download it.
              </li>
              <li>
                <span className="font-semibold">Run Installer:</span> Once
                downloaded, open the <code>.exe</code> file to begin the
                installation.
              </li>
              <li>
                <span className="font-semibold">Approve Install:</span> Click{" "}
                <span className="font-semibold">Yes</span> when Windows asks for
                permission to make changes.
              </li>
              <li>Follow the same authentication steps as the web version.</li>
            </ol>

            {/* Note Block */}
            <div className="p-4 rounded-lg border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20">
              <p className="font-semibold not-prose text-blue-800 dark:text-blue-200">
                Windows Protected Your PC?
              </p>
              <p className="not-prose text-sm text-blue-700 dark:text-blue-300">
                You may see a blue "Windows protected your PC" screen. This is
                expected.
              </p>
              <ol className="not-prose text-sm text-blue-700 dark:text-blue-300">
                <li>
                  Click the small text that says{" "}
                  <span className="font-semibold">"More info"</span>.
                </li>
                <li>
                  A new button,{" "}
                  <span className="font-semibold">"Run anyway"</span>, will
                  appear. Click it.
                </li>
              </ol>
              <p className="not-prose text-xs text-blue-600 dark:text-blue-400 mt-2">
                <i>
                  *This warning appears simply because the app is not registered
                  with Microsoft (a costly process). It is safe to install if
                  downloaded directly from this GitHub repository or distributed
                  throughout the organization.
                </i>
              </p>
            </div>

            <h2>Getting Started: For Meeting Hosts (Sending Audio)</h2>
            <p>
              As the host, you are responsible for sending the meeting's audio
              to the translation service.
            </p>
            <ul>
              <li>
                <span className="font-semibold">Authorize App:</span> Ensure the
                CALC Translation App (the app from the Zoom Marketplace, not the
                desktop app) is installed and authorized for your Zoom account.
                Contact your IT Administrator if you need this set up.
              </li>
              <li>
                <span className="font-semibold">Start Meeting:</span> Start your
                Zoom meeting as the host.
              </li>
              <li>
                <span className="font-semibold">Run App:</span> Open the app
                within your Zoom client. This action begins the secure audio
                stream to our servers.
              </li>
              <li>
                <span className="font-semibold">Confirm:</span> Inform your
                participants that the feed is now live and they can view it on
                the web or desktop application.
              </li>
            </ul>

            <h1>Frequently Asked Questions (FAQ)</h1>
            <p>
              <span className="font-semibold">
                Q: (As a Viewer) The translation feed is blank or not updating.
                What should I do?
              </span>
            </p>
            <p>
              - First, try refreshing the web page or restarting the desktop
              application. If it's still not working, the meeting host may not
              have started the audio feed from their end. Please notify the host
              that the feed is not active.
            </p>

            <p>
              <span className="font-semibold">
                Q: (As a Host) Participants say the translation is not
                appearing. What should I do?
              </span>
            </p>
            <p>
              - First, check that the CALC Translation App is open and active in
              your Zoom meeting. Second, try pausing or stopping the Zoom app
              temporarily. If it's still not working, try leaving the meeting
              and rejoining.
            </p>

            <p>
              <span className="font-semibold">
                Q: As a participant (viewer), do I need to install anything in
                Zoom?
              </span>
            </p>
            <p>
              - No. You only need to access the web URL or use the optional
              desktop viewing application. Only the meeting host installs an app
              within Zoom.
            </p>

            <p>
              <span className="font-semibold">
                Q: The translation is inaccurate or has errors.
              </span>
            </p>
            <p>
              - The app uses an advanced AI service (Soniox) for translation,
              but it is not perfect. Accuracy can be affected by:
            </p>
            <ul>
              <li>Poor audio quality</li>
              <li>Significant background noise in the meeting</li>
              <li>Multiple people speaking at once</li>
              <li>Very fast or unclear speech</li>
            </ul>

            <p>
              <span className="font-semibold">
                Q: I can't find the transcript from my last meeting.
              </span>
            </p>
            <p>
              - Only users who attended a specific meeting can access its stored
              transcript. If you attended the meeting and still cannot find the
              transcript, please contact your IT administrator for assistance
              with access rights.
            </p>

            <p>
              <span className="font-semibold">
                Q: Who can see the live translation?
              </span>
            </p>
            <p>
              - The real-time transcription and translation feed is visible to
              all authenticated meeting participants using the web or desktop
              application.
            </p>

            <p>
              <span className="font-semibold">
                Q: Who can access the stored transcript after the meeting?
              </span>
            </p>
            <p>
              - Access is restricted to users who attended the meeting. Please
              handle all transcripts as confidential company information, in
              line with our internal data policies.
            </p>

            <h1>How to Get Direct Support</h1>
            <p>
              If the FAQ above does not solve your problem, we are here to help.
            </p>
            <p>
              <span className="font-semibold">
                For Technical Support, Bug Reports, or Feature Questions:
              </span>
              <br />
              Please contact the application developer directly:
            </p>
            <ul>
              <li>Contact: Jonah Carpenter</li>
              <li>Method: Please use the email icon below.</li>
            </ul>
            <p>
              When reporting a bug, please include as much detail as possible:
            </p>
            <ul>
              <li>Inclue "CALC Translation App" in the subject line.</li>
              <li>The date and time the issue occurred</li>
              <li>The Zoom Meeting ID (if possible)</li>
              <li>
                A brief description of what happened, and ideally screenshots
                when applicable.
              </li>
            </ul>

            <p>
              <span className="font-semibold">
                For Installation, Access, or Policy Questions:
              </span>
              <br />
              For issues related to installing the app, getting authorization
              for your Zoom account, or accessing specific meeting transcripts,
              please contact:
            </p>
            <ul>
              <li>Contact: Your internal IT Administrator</li>
            </ul>
            <div className="mt-8 text-center not-prose">
              <Link
                to="/"
                className="inline-flex items-center justify-center px-6 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Go to Home
              </Link>
            </div>
          </article>
        </div>
      </main>

      <Footer />
    </div>
  );
}
