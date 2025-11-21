import Header from "../components/header";
import Footer from "../components/footer";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";

export default function Privacy() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <ThemeToggle />
        <LanguageToggle />
      </Header>

      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          <article className="prose dark:prose-invert lg:prose-xl">
            <h1>Privacy Policy</h1>
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
              <span className="font-semibold">Purpose</span>
            </h2>
            <p>
              This Privacy Policy applies to the CALC Translation application.
              This App is developed and maintained by Jonah Carpenter and is
              intended solely for internal use by authorized members of the CALC
              organization or its subsidiaries.
            </p>
            <p>
              The purpose of the App is to provide real-time translation and
              transcription services during internal Zoom meetings to improve
              communication and accessibility for our staff.
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Information We Process</span>
            </h2>
            <p>
              To provide its services, the App processes the following data:
            </p>
            <ul>
              <li>
                <span className="font-semibold">Real-Time Audio Data:</span> The
                App captures the audio stream from your Zoom meeting in
                real-time. This audio is immediately processed to generate
                translations and transcriptions.
              </li>
              <li>
                <span className="font-semibold">User Identifiers:</span> We use
                basic Zoom participant information (e.g., display name) to
                accurately attribute speech to the correct speaker in the live
                transcription and the final stored transcript.
              </li>
              <li>
                <span className="font-semibold">
                  Transcription and Translation Data:
                </span>{" "}
                This is the text generated from the audio stream. This text is
                displayed live during the meeting and within the downloadable
                transcript file on meeting end.
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">
                Data Sharing and Third-Party Services
              </span>
            </h2>
            <p>
              We do not sell, rent, or trade any personal data with third
              parties for marketing or advertising purposes.
            </p>
            <p>
              To provide the core translation functionality, we must share a
              live audio stream with a third-party services.
            </p>
            <ul>
              <li>
                <span className="font-semibold">Service Provider:</span> We use{" "}
                <a href="https://soniox.com">Soniox</a> as a sub-processor to
                convert speech to text and perform translation.
              </li>
              <li>
                <span className="font-semibold">Data Shared:</span> Only the
                real-time meeting audio is sent to this provider.
              </li>
              <li>
                <span className="font-semibold">Purpose:</span> This sharing is
                strictly for the purpose of generating the translation and
                transcription.
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">
                Data Storage, Retention, and Security
              </span>
            </h2>
            <ul>
              <li>
                <span className="font-semibold">Data Storage:</span> The App
                stores the final meeting transcript. This transcript includes
                the full text of the transcription, speaker names, and
                timestamps.
              </li>
              <li>
                <span className="font-semibold">Data Retention:</span> Stored
                transcripts are retained on our secure cloud database
              </li>
              <li>
                <span className="font-semibold">Security:</span> We implement
                reasonable administrative, technical, and physical safeguards to
                protect the data we process and store. This includes per meeting
                authentication, and secure tokens between client and server to
                prevent unauthorized access, use, or disclosure.
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">Access to Information</span>
            </h2>
            <p>Access to data is strictly controlled:</p>
            <ul>
              <li>
                <span className="font-semibold">App Installation:</span> Only
                authorized Zoom accounts within the organization can install and
                use the App using the private URL.
              </li>
              <li>
                <span className="font-semibold">Live Data:</span> The real-time
                transcription and translation feed is visible to all
                participants in the Zoom meeting for transparency given they
                have the proper meeting credentials.
              </li>
              <li>
                <span className="font-semibold">Stored Transcripts:</span>{" "}
                Access to stored transcripts is restricted to users attending or
                attended a given meeting.
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">
                User Rights and Data Management
              </span>
            </h2>
            <p>
              In accordance with our internal data governance policies,
              employees may have the right to access, review, or request the
              deletion of a meeting transcript they participated in.
            </p>
            <p>
              All requests will be handled in line with company policy and data
              retention requirements. To make such a request, please contact the
              developer or your IT administrator via the contact information
              below.
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Changes to this Policy</span>
            </h2>
            <p>
              This policy may be updated periodically to reflect changes in our
              operations, technology, or compliance obligations. All internal
              users will be notified of material updates through official
              company communication channels.
            </p>
            <hr />

            <h2>
              <span className="font-semibold">Contact Information</span>
            </h2>
            <p>
              For any questions, concerns, or data requests related to this
              Privacy Policy or the App, please contact the application
              developer, Jonah Carpenter, via the email icon below.
            </p>
          </article>
        </div>
      </main>

      <Footer />
    </div>
  );
}
