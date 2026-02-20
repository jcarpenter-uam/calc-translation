import React, { useState } from "react";
import { BiSearch } from "react-icons/bi";
import { useTranslation } from "react-i18next";

export const languages = [
  { name: "Afrikaans", flag: "za", code: "af" },
  { name: "Albanian", flag: "al", code: "sq" },
  { name: "Arabic", flag: "sa", code: "ar" },
  { name: "Azerbaijani", flag: "az", code: "az" },
  {
    name: "Basque",
    flag: "https://upload.wikimedia.org/wikipedia/commons/2/2d/Flag_of_the_Basque_Country.svg",
    code: "eu",
  },
  { name: "Belarusian", flag: "by", code: "be" },
  { name: "Bengali", flag: "bd", code: "bn" },
  { name: "Bosnian", flag: "ba", code: "bs" },
  { name: "Bulgarian", flag: "bg", code: "bg" },
  {
    name: "Catalan",
    flag: "https://upload.wikimedia.org/wikipedia/commons/c/ce/Flag_of_Catalonia.svg",
    code: "ca",
  },
  { name: "Chinese", flag: "cn", code: "zh" },
  { name: "Croatian", flag: "hr", code: "hr" },
  { name: "Czech", flag: "cz", code: "cs" },
  { name: "Danish", flag: "dk", code: "da" },
  { name: "Dutch", flag: "nl", code: "nl" },
  { name: "English", flag: "gb", code: "en" },
  { name: "Estonian", flag: "ee", code: "et" },
  { name: "Finnish", flag: "fi", code: "fi" },
  { name: "French", flag: "fr", code: "fr" },
  {
    name: "Galician",
    flag: "https://upload.wikimedia.org/wikipedia/commons/6/64/Flag_of_Galicia.svg",
    code: "gl",
  },
  { name: "German", flag: "de", code: "de" },
  { name: "Greek", flag: "gr", code: "el" },
  { name: "Gujarati", flag: "in", code: "gu" },
  { name: "Hebrew", flag: "il", code: "he" },
  { name: "Hindi", flag: "in", code: "hi" },
  { name: "Hungarian", flag: "hu", code: "hu" },
  { name: "Indonesian", flag: "id", code: "id" },
  { name: "Italian", flag: "it", code: "it" },
  { name: "Japanese", flag: "jp", code: "ja" },
  { name: "Kannada", flag: "in", code: "kn" },
  { name: "Kazakh", flag: "kz", code: "kk" },
  { name: "Korean", flag: "kr", code: "ko" },
  { name: "Latvian", flag: "lv", code: "lv" },
  { name: "Lithuanian", flag: "lt", code: "lt" },
  { name: "Macedonian", flag: "mk", code: "mk" },
  { name: "Malay", flag: "my", code: "ms" },
  { name: "Malayalam", flag: "in", code: "ml" },
  { name: "Marathi", flag: "in", code: "mr" },
  { name: "Norwegian", flag: "no", code: "no" },
  { name: "Persian", flag: "ir", code: "fa" },
  { name: "Polish", flag: "pl", code: "pl" },
  { name: "Portuguese", flag: "pt", code: "pt" },
  { name: "Punjabi", flag: "in", code: "pa" },
  { name: "Romanian", flag: "ro", code: "ro" },
  { name: "Russian", flag: "ru", code: "ru" },
  { name: "Serbian", flag: "rs", code: "sr" },
  { name: "Slovak", flag: "sk", code: "sk" },
  { name: "Slovenian", flag: "si", code: "sl" },
  { name: "Spanish", flag: "es", code: "es" },
  { name: "Swahili", flag: "tz", code: "sw" },
  { name: "Swedish", flag: "se", code: "sv" },
  { name: "Tagalog", flag: "ph", code: "tl" },
  { name: "Tamil", flag: "in", code: "ta" },
  { name: "Telugu", flag: "in", code: "te" },
  { name: "Thai", flag: "th", code: "th" },
  { name: "Turkish", flag: "tr", code: "tr" },
  { name: "Ukrainian", flag: "ua", code: "uk" },
  { name: "Urdu", flag: "pk", code: "ur" },
  { name: "Vietnamese", flag: "vn", code: "vi" },
  { name: "Welsh", flag: "gb-wls", code: "cy" },
];

export default function SupportedLangs() {
  const { t } = useTranslation();
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
        <h2 className="text-3xl font-semibold text-center mb-8 tracking-tight text-zinc-900 dark:text-white">
          {t("standalone_supported_langs_title", { count: languages.length })}
        </h2>

        <div className="relative w-full max-w-lg mb-12 group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none z-10">
            <BiSearch className="text-zinc-400 dark:text-zinc-500 text-xl" />
          </div>
          <input
            type="text"
            placeholder={t("standalone_supported_langs_search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 text-base rounded-full pl-12 pr-6 py-4
                     focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10
                     transition-all duration-300 placeholder-zinc-400 dark:placeholder-zinc-500 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-600"
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
              <div className="col-span-full text-center text-zinc-500 dark:text-zinc-400 py-12">
                <p className="text-lg">
                  {t("standalone_supported_langs_no_match", { query })}
                </p>
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
  <div className="flex-shrink-0 flex items-center bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 rounded-full px-5 py-3 transition-all duration-300 cursor-default group hover:shadow-md hover:-translate-y-0.5">
    <img
      src={
        lang.flag.startsWith("http")
          ? lang.flag
          : `https://flagcdn.com/${lang.flag}.svg`
      }
      alt={lang.name}
      className="w-6 h-6 rounded-full object-cover mr-3 pointer-events-none group-hover:scale-110 transition-transform duration-300 shadow-sm"
    />
    <span className="text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white text-sm font-medium whitespace-nowrap">
      {lang.name}
    </span>
  </div>
);
