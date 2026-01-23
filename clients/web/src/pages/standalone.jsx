import OneWay from "../components/standalone/one-way";
import SupportedLangs from "../components/standalone/supported-langs";
import TwoWay from "../components/standalone/two-way";

export default function StandalonePage() {
  return (
    <>
      <SupportedLangs />
      <OneWay />
      <TwoWay />
    </>
  );
}
