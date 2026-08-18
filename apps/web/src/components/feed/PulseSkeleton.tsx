// Pulse cold-load placeholder. Mirrors PulseFeed's own layout — hero band,
// 1fr/320px body split, and the seven-column card grid — so the real feed
// drops straight into the same boxes when it lands.

import { Skeleton } from "../Skeleton";
import { styles } from "./PulseFeed.styles";

const ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RAIL_BLOCKS = ["distribution", "movers", "health"];

export default function PulseSkeleton() {
  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div style={{ minWidth: 0 }}>
          <Skeleton w={220} h={18} style={{ marginBottom: 14 }} />
          <Skeleton w={520} h={40} />
          <Skeleton w={400} h={13} style={{ marginTop: 18 }} />
        </div>
        <div style={styles.heroStats}>
          {["ccu", "movers", "new"].map((k) => (
            <div key={k} style={styles.heroStat}>
              <Skeleton w={72} h={9} />
              <Skeleton w={56} h={22} />
            </div>
          ))}
        </div>
      </div>

      <div style={styles.body}>
        <div style={styles.feedCol}>
          <div style={styles.feedHeader}>
            <Skeleton w={130} h={12} />
            <Skeleton w={90} h={12} />
          </div>
          {ROWS.map((k) => (
            <div
              key={k}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "18px 72px minmax(0, 1fr) 150px 200px 70px 130px",
                gap: 20,
                alignItems: "center",
                padding: "20px 32px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <Skeleton w={10} h={10} />
              <Skeleton w={72} h={54} style={{ borderRadius: 6 }} />
              <div style={{ display: "grid", gap: 8 }}>
                <Skeleton w="62%" h={14} />
                <Skeleton w="34%" h={10} />
              </div>
              <Skeleton w={96} h={12} />
              <Skeleton w={180} h={28} />
              <Skeleton w={44} h={12} />
              <Skeleton w={110} h={12} />
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            alignContent: "start",
            gap: 28,
            padding: 24,
          }}
        >
          {RAIL_BLOCKS.map((k) => (
            <div key={k} style={{ display: "grid", gap: 10 }}>
              <Skeleton w={104} h={9} />
              <Skeleton w="100%" h={12} />
              <Skeleton w="82%" h={12} />
              <Skeleton w="64%" h={12} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
