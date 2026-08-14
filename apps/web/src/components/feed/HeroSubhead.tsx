import { fmtCCU } from "#/lib/format";
import { styles } from "./PulseFeed.styles";

export default function HeroSubhead({
  trackedCcu,
  movers,
  new48h,
  totalTracked,
}: {
  trackedCcu: number;
  movers: number;
  new48h: number;
  totalTracked: number;
}) {
  if (trackedCcu === 0) {
    return (
      <div
        style={{
          ...styles.heroSub,
          fontFamily: "'Instrument Serif', serif",
          fontStyle: "italic",
          color: "#a8a29e",
        }}
      >
        The pulse is quiet. We'll tell you when something moves.
      </div>
    );
  }
  return (
    <div style={styles.heroSub}>
      <span style={{ color: "#fafaf9", fontWeight: 500 }}>
        {fmtCCU(trackedCcu, { compact: true })}
      </span>{" "}
      concurrent under watch ·{" "}
      <span style={{ color: "#fafaf9", fontWeight: 500 }}>{movers}</span>{" "}
      {totalTracked > movers ? (
        <>
          movers from{" "}
          <span style={{ color: "#fafaf9", fontWeight: 500 }}>
            {totalTracked.toLocaleString("en-US")}
          </span>{" "}
          tracked
        </>
      ) : (
        "movers"
      )}{" "}
      · <span style={{ color: "#c4b5fd" }}>{new48h}</span> new in 48h
    </div>
  );
}
