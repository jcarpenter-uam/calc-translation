import React, { useState } from "react";
import { BiSearch } from "react-icons/bi";

const languages = [
  { name: "Afrikaans", flag: "za" },
  { name: "Albanian", flag: "al" },
  { name: "Arabic", flag: "sa" },
  { name: "Azerbaijani", flag: "az" },
  {
    name: "Basque",
    flag: "https://upload.wikimedia.org/wikipedia/commons/2/2d/Flag_of_the_Basque_Country.svg",
  },
  { name: "Belarusian", flag: "by" },
  { name: "Bengali", flag: "bd" },
  { name: "Bosnian", flag: "ba" },
  { name: "Bulgarian", flag: "bg" },
  {
    name: "Catalan",
    flag: "https://upload.wikimedia.org/wikipedia/commons/c/ce/Flag_of_Catalonia.svg",
  },
  { name: "Chinese", flag: "cn" },
  { name: "Croatian", flag: "hr" },
  { name: "Czech", flag: "cz" },
  { name: "Danish", flag: "dk" },
  { name: "Dutch", flag: "nl" },
  { name: "English", flag: "gb" },
  { name: "Estonian", flag: "ee" },
  { name: "Finnish", flag: "fi" },
  { name: "French", flag: "fr" },
  {
    name: "Galician",
    flag: "https://upload.wikimedia.org/wikipedia/commons/6/64/Flag_of_Galicia.svg",
  },
  { name: "German", flag: "de" },
  { name: "Greek", flag: "gr" },
  { name: "Gujarati", flag: "in" },
  { name: "Hebrew", flag: "il" },
  { name: "Hindi", flag: "in" },
  { name: "Hungarian", flag: "hu" },
  { name: "Indonesian", flag: "id" },
  { name: "Italian", flag: "it" },
  { name: "Japanese", flag: "jp" },
  { name: "Kannada", flag: "in" },
  { name: "Kazakh", flag: "kz" },
  { name: "Korean", flag: "kr" },
  { name: "Latvian", flag: "lv" },
  { name: "Lithuanian", flag: "lt" },
  { name: "Macedonian", flag: "mk" },
  { name: "Malay", flag: "my" },
  { name: "Malayalam", flag: "in" },
  { name: "Marathi", flag: "in" },
  { name: "Norwegian", flag: "no" },
  { name: "Persian", flag: "ir" },
  { name: "Polish", flag: "pl" },
  { name: "Portuguese", flag: "pt" },
  { name: "Punjabi", flag: "in" },
  { name: "Romanian", flag: "ro" },
  { name: "Russian", flag: "ru" },
  { name: "Serbian", flag: "rs" },
  { name: "Slovak", flag: "sk" },
  { name: "Slovenian", flag: "si" },
  { name: "Spanish", flag: "es" },
  { name: "Swahili", flag: "tz" },
  { name: "Swedish", flag: "se" },
  { name: "Tagalog", flag: "ph" },
  { name: "Tamil", flag: "in" },
  { name: "Telugu", flag: "in" },
  { name: "Thai", flag: "th" },
  { name: "Turkish", flag: "tr" },
  { name: "Ukrainian", flag: "ua" },
  { name: "Urdu", flag: "pk" },
  { name: "Vietnamese", flag: "vn" },
  { name: "Welsh", flag: "gb-wls" },
];

export default function SupportedLangs() {
  const [query, setQuery] = useState("");

  const filteredLanguages = languages.filter((lang) =>
    lang.name.toLowerCase().includes(query.toLowerCase()),
  );

  const seamlessList = [...languages, ...languages];

  return (
    <section className="w-full flex flex-col items-center justify-center overflow-hidden">
      <style>
        {`
          @keyframes infinite-scroll {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          .animate-infinite-scroll {
            animation: infinite-scroll 80s linear infinite;
          }
          .animate-infinite-scroll:hover {
            animation-play-state: paused;
          }
          /* This mask creates the fade effect using transparency, 
             so it works on ANY background color */
          .mask-gradient {
            mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
            -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
          }
        `}
      </style>

      <div className="container mx-auto px-4 flex flex-col items-center">
        <h2 className="text-3xl font-semibold text-center mb-8 tracking-tight">
          Works across {languages.length} languages
        </h2>

        <div className="relative w-full max-w-lg mb-12 group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none z-10">
            <BiSearch className="text-gray-400 text-xl" />
          </div>
          <input
            type="text"
            placeholder="Find your language..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-[#1e1e24] border border-gray-800 text-white text-base rounded-full pl-12 pr-6 py-4 
                     focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 
                     transition-all duration-300 placeholder-gray-500 shadow-lg hover:border-gray-700"
          />
        </div>
      </div>

      {query ? (
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {filteredLanguages.length > 0 ? (
              filteredLanguages.map((lang) => (
                <LanguagePill key={lang.name} lang={lang} />
              ))
            ) : (
              <div className="col-span-full text-center text-gray-500 py-12">
                <p className="text-lg">No languages found matching "{query}"</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="w-full max-w-full overflow-hidden mask-gradient py-4">
          <div className="flex animate-infinite-scroll gap-4 w-max px-4">
            {seamlessList.map((lang, index) => (
              <LanguagePill key={`${lang.name}-${index}`} lang={lang} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

const LanguagePill = ({ lang }) => (
  <div className="flex-shrink-0 flex items-center bg-[#1e1e24] hover:bg-[#2a2a35] border border-gray-800 hover:border-gray-600 rounded-full px-5 py-3 transition-all duration-300 cursor-default group hover:shadow-lg hover:-translate-y-0.5">
    <img
      src={
        lang.flag.startsWith("http")
          ? lang.flag
          : `https://flagcdn.com/${lang.flag}.svg`
      }
      alt={lang.name}
      className="w-6 h-6 rounded-full object-cover mr-3 pointer-events-none group-hover:scale-110 transition-transform duration-300 shadow-sm"
    />
    <span className="text-gray-300 group-hover:text-white text-sm font-medium whitespace-nowrap">
      {lang.name}
    </span>
  </div>
);
