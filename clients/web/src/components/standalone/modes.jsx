import React from "react";
import {
  BiCaptions,
  BiMicrophone,
  BiUser,
  BiSelectMultiple,
  BiConversation,
  BiHeadphone,
  BiLogoZoom,
  BiPlay,
} from "react-icons/bi";

export default function TranslationModes({ onSubmit }) {
  const handleOneWayStart = () => {
    onSubmit({ mode: "host" });
  };

  // const handleTwoWayStart = () => {
  //   onSubmit({ mode: "host" });
  // };

  return (
    <section className="w-full py-10 px-6 flex justify-center">
      <div className="max-w-7xl w-full grid md:grid-cols-2 gap-20">
        {/* === One-Way === */}
        <div className="flex flex-col h-full p-6 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 transition-all duration-300">
          <div className="flex-grow">
            <OneWay />
          </div>

          <div className="mt-8">
            <button
              type="button"
              onClick={handleOneWayStart}
              className="cursor-pointer group w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold text-lg rounded-xl shadow-lg shadow-blue-900/20 hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
            >
              <div className="p-1 bg-white/20 rounded-full group-hover:bg-white/30 transition-colors">
                <BiPlay className="w-6 h-6 ml-0.5" />
              </div>
              Start One-Way Meeting
            </button>
            <p className="text-center text-zinc-500 text-sm mt-3">
              Best for presentations & speeches
            </p>
          </div>
        </div>

        {/* === Two-Way === */}
        <div className="flex flex-col h-full p-6 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 transition-all duration-300">
          <div className="flex-grow">
            <TwoWay />
          </div>

          {/* <div className="mt-8"> */}
          {/*   <button */}
          {/*     type="button" */}
          {/*     onClick={handleTwoWayStart} */}
          {/*     className="cursor-pointer group w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold text-lg rounded-xl shadow-lg shadow-emerald-900/20 hover:shadow-emerald-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200" */}
          {/*   > */}
          {/*     <div className="p-1 bg-white/20 rounded-full group-hover:bg-white/30 transition-colors"> */}
          {/*       <BiPlay className="w-6 h-6 ml-0.5" /> */}
          {/*     </div> */}
          {/*     Start Two-Way Meeting */}
          {/*   </button> */}
          {/*   <p className="text-center text-zinc-500 text-sm mt-3"> */}
          {/*     Best for conversations & interviews */}
          {/*   </p> */}
          {/* </div> */}
          <div className="mt-8">
            <button
              type="button"
              disabled
              className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-zinc-800 border border-zinc-700 text-zinc-500 font-bold text-lg rounded-xl cursor-not-allowed opacity-80"
            >
              Coming Soon
            </button>
            <p className="text-center text-zinc-600 text-sm mt-3">
              Best for conversations & interviews
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureItem({ icon, title, desc, color = "blue" }) {
  const colors = {
    blue: "group-hover:bg-blue-500/10 group-hover:text-blue-400",
    emerald: "group-hover:bg-emerald-500/10 group-hover:text-emerald-400",
  };

  return (
    <div className="flex items-start space-x-4 group">
      <div
        className={`shrink-0 p-3 bg-zinc-900 rounded-lg text-zinc-400 transition-colors duration-300 mt-1 ${colors[color]}`}
      >
        {icon}
      </div>
      <div>
        <h4 className="text-zinc-200 group-hover:text-white font-medium text-lg transition-colors">
          {title}
        </h4>
        <p className="text-zinc-400 text-sm mt-1 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function OneWay() {
  return (
    <div className="space-y-10 h-full flex flex-col">
      <div>
        <h2 className="text-3xl md:text-4xl font-bold text-white leading-tight mb-6">
          One-Way Translation
        </h2>
        <p className="text-zinc-400 text-lg leading-relaxed">
          Everyone speaks their mind; you hear what matters. Our system
          automatically translates all incoming audio into
          <span className="text-white font-semibold">
            {" "}
            each viewers preferred language
          </span>
          .
        </p>
      </div>

      <div className="space-y-6">
        <FeatureItem
          color="blue"
          icon={<BiCaptions className="w-6 h-6" />}
          title="Read in your language"
          desc="Regardless of what language is spoken, you receive the text in your native tongue."
        />
        <FeatureItem
          color="blue"
          icon={<BiMicrophone className="w-6 h-6" />}
          title="Speak freely"
          desc="Talk in the language you are most comfortable with. We handle the rest."
        />
        <FeatureItem
          color="blue"
          icon={<BiUser className="w-6 h-6" />}
          title="Easy for users"
          desc="Anyone within the meeting can freely change their preferred language without affecting anyone else."
        />
        <FeatureItem
          color="blue"
          icon={<BiLogoZoom className="w-6 h-6" />}
          title="Used for Zoom"
          desc="This is how our Zoom integration works"
        />
      </div>
    </div>
  );
}

function TwoWay() {
  return (
    <div className="space-y-10 h-full flex flex-col">
      <div>
        <h2 className="text-3xl md:text-4xl font-bold text-white leading-tight mb-6">
          Two-Way Translation
        </h2>
        <p className="text-zinc-400 text-lg leading-relaxed">
          Seamlessly bridge the gap between two people. The host selects{" "}
          <span className="text-white font-semibold">two active languages</span>
          , allowing fluid, back-and-forth dialogue without pauses. Displaying
          everything said in both languages.
        </p>
      </div>

      <div className="space-y-6">
        <FeatureItem
          color="emerald"
          icon={<BiSelectMultiple className="w-6 h-6" />}
          title="Host Controlled"
          desc="The host selects the exact language pair (e.g., English & Spanish) for the session."
        />
        <FeatureItem
          color="emerald"
          icon={<BiConversation className="w-6 h-6" />}
          title="Fluid Dialogue"
          desc="No toggling required. Both parties simply speak, and the system handles the routing instantly."
        />
        <FeatureItem
          color="emerald"
          icon={<BiHeadphone className="w-6 h-6" />}
          title="Exclusive Channel"
          desc="Unlike One-Way mode, this is restricted to the two selected languages for maximum accuracy."
        />
      </div>
    </div>
  );
}
