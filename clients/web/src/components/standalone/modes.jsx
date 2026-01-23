import React from "react";
import {
  BiCaptions,
  BiMicrophone,
  BiUser,
  BiSelectMultiple,
  BiConversation,
  BiHeadphone,
  BiLogoZoom,
} from "react-icons/bi";

export default function TranslationModes() {
  return (
    <section className="w-full py-10 px-6 flex justify-center border-t border-gray-900">
      <div className="max-w-7xl w-full grid md:grid-cols-2 gap-20">
        <OneWay />

        <TwoWay />
      </div>
    </section>
  );
}

function OneWay() {
  return (
    <div className="space-y-10 h-full flex flex-col">
      <div>
        <h2 className="text-3xl md:text-4xl font-bold text-white leading-tight mb-6">
          One-Way Translation
        </h2>
        <p className="text-gray-400 text-lg leading-relaxed">
          Everyone speaks their mind; you hear what matters. Our system
          automatically translates all incoming audio into
          <span className="text-white font-semibold">
            {" "}
            your preferred language
          </span>
          .
        </p>
      </div>

      <div className="space-y-6">
        <FeatureItem
          icon={<BiCaptions className="w-6 h-6" />}
          title="Read in your language"
          desc="Regardless of what language is spoken, you receive the text in your native tongue."
        />
        <FeatureItem
          icon={<BiMicrophone className="w-6 h-6" />}
          title="Speak freely"
          desc="Talk in the language you are most comfortable with. We handle the rest."
        />
        <FeatureItem
          icon={<BiUser className="w-6 h-6" />}
          title="Easy for users"
          desc="Anyone within the meeting can freely change their preferred language without affecting anyone else."
        />
        <FeatureItem
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
        <p className="text-gray-400 text-lg leading-relaxed">
          Seamlessly bridge the gap between two people. The host selects{" "}
          <span className="text-white font-semibold">two active languages</span>
          , allowing fluid, back-and-forth dialogue without pauses. Displaying
          everything said in both languages.
        </p>
      </div>

      <div className="space-y-6">
        <FeatureItem
          icon={<BiSelectMultiple className="w-6 h-6" />}
          title="Host Controlled"
          desc="The host selects the exact language pair (e.g., English & Spanish) for the session."
        />
        <FeatureItem
          icon={<BiConversation className="w-6 h-6" />}
          title="Fluid Dialogue"
          desc="No toggling required. Both parties simply speak, and the system handles the routing instantly."
        />
        <FeatureItem
          icon={<BiHeadphone className="w-6 h-6" />}
          title="Exclusive Channel"
          desc="Unlike One-Way mode, this is restricted to the two selected languages for maximum accuracy."
        />
      </div>
    </div>
  );
}

function FeatureItem({ icon, title, desc }) {
  return (
    <div className="flex items-start space-x-4 group">
      <div className="shrink-0 p-3 bg-gray-800/50 group-hover:bg-blue-600/20 rounded-lg text-gray-300 group-hover:text-blue-400 transition-colors duration-300 mt-1">
        {icon}
      </div>
      <div>
        <h4 className="text-white font-medium text-lg">{title}</h4>
        <p className="text-gray-500 text-sm mt-1 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
