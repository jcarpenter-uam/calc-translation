import { Link } from "react-router-dom";
import Header from "../components/header";
import Footer from "../components/footer";
import ThemeToggle from "../components/theme-toggle.jsx";
import Language from "../components/language.jsx";

export default function Terms() {
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
            <h1>Terms of Service</h1>
            <p>
              <span className="font-semibold">
                This application is intended for internal organization use
              </span>
            </p>
            <p>
              <span className="font-semibold">
                Effective Date: November 2025
              </span>
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Acceptance of Terms</span>
            </h2>
            <p>
              These Terms of Service govern your use of the CALC Translation
              application, developed by Jonah Carpenter. The App is provided
              solely for internal use by authorized members of the CALC
              organization or its subsidiaries.
            </p>
            <p>
              By installing, accessing, or using the App, you agree to be bound
              by these Terms and the accompanying CALC Translation App Privacy
              Policy. If you do not agree to these terms, do not install or use
              the App.
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Purpose and Grant of Use</span>
            </h2>
            <p>
              The App provides real-time translation and transcription services
              during internal Zoom meetings to improve communication and
              accessibility for our staff.
            </p>
            <p>
              Subject to your compliance with these Terms, you are granted a
              limited, non-exclusive, non-transferable, and revocable license to
              use the App on organization-authorized devices, solely for
              internal business purposes as an Authorized User.
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Privacy and Data Handling</span>
            </h2>
            <p>
              Your use of the App is subject to the CALC Translation App Privacy
              Policy, which details how we process, store, and share
              information. By using the App, you acknowledge and agree that:
            </p>
            <ul>
              <li>
                The App processes real-time audio data from your Zoom meetings.
              </li>
              <li>
                The App uses basic user identifiers (e.g., display name) to
                attribute speech.
              </li>
              <li>The App generates and stores meeting transcripts.</li>
              <li>
                Real-time audio data is shared with a third-party sub-processor
                (Soniox) for the sole purpose of generating transcriptions and
                translations.
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">
                User Conduct and Responsibilities
              </span>
            </h2>
            <p>As an Authorized User, you agree to the following:</p>
            <ul>
              <li>
                <span className="font-semibold">Authorized Use:</span> You will
                only use the App if you are an active and authorized member of
                the CALC organization or its subsidiaries. You will not share
                your access credentials with any unauthorized person or external
                party.
              </li>
              <li>
                <span className="font-semibold">Confidentiality:</span> Meeting
                transcripts generated and stored by the App are considered
                internal company data. You must handle these transcripts in
                accordance with all applicable internal company policies
                regarding confidential information.
              </li>
            </ul>
            <p>
              <span className="font-semibold">Prohibited Actions:</span> You
              agree not to:
            </p>
            <ul>
              <li>
                Attempt to access transcripts from meetings you did not attend,
                unless explicitly authorized by internal policy.
              </li>
              <li>
                Use the App for any illegal, unauthorized, or unethical purpose.
              </li>
              <li>
                Attempt to reverse-engineer, decompile, or otherwise access the
                source code of the App.
              </li>
              <li>
                Bypass or attempt to bypass any security measures, such as
                authentication or JWT tokens.
              </li>
              <li>
                Use the service in a manner that could damage, disable, or
                overburden the App or its underlying systems.
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">Access to Information</span>
            </h2>
            <p>Your access to data through the App is strictly controlled:</p>
            <ul>
              <li>
                <span className="font-semibold">Live Data:</span> The real-time
                transcription and translation feed is visible to all active
                participants in the corresponding Zoom meeting.
              </li>
              <li>
                <span className="font-semibold">Stored Transcripts:</span>{" "}
                Access to stored transcripts is restricted to Authorized Users
                who attended the specific meeting.
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">Disclaimer of Warranties</span>
            </h2>
            <p>
              The App is provided "as-is" and "as available" without any
              warranties, express or implied.
            </p>
            <p>
              Translation and transcription are complex processes that may be
              subject to errors. We do not warrant or guarantee the 100%
              accuracy, completeness, or reliability of any translation or
              transcription provided by the App. The developer and the
              organization are not liable for any misunderstandings, errors,
              omissions, or decisions made based on the information provided by
              the App.
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Termination of Use</span>
            </h2>
            <p>
              Your right to use the App may be suspended or terminated at any
              time, with or without notice, by your organization or the
              developer for any reason, including but not limited to a breach of
              these Terms or a change in your employment status.
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Changes to These Terms</span>
            </h2>
            <p>
              These Terms may be updated periodically to reflect changes in our
              operations, technology, or compliance obligations. All internal
              users will be notified of material updates through official
              company communication channels. Continued use of the App after
              such a notification constitutes your acceptance of the new Terms.
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Contact Information</span>
            </h2>
            <p>
              For any questions or concerns related to these Terms of Service or
              the App, please contact the application developer, Jonah
              Carpenter, via the email icon below.
            </p>
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
