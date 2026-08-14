import { s } from "./SearchModal.styles";

const SKELETON_COUNT = 5;

export default function SearchSkeleton() {
  return (
    <>
      {Array.from({ length: SKELETON_COUNT }, (_, i) => `skel-${i}`).map(
        (k) => (
          <div key={k} style={s.resultRow}>
            <div className="search-skeleton" style={s.skelThumb} />
            <div style={s.resultInfo}>
              <div className="search-skeleton" style={s.skelLineMain} />
              <div className="search-skeleton" style={s.skelLineSub} />
            </div>
            <div className="search-skeleton" style={s.skelCcu} />
          </div>
        ),
      )}
    </>
  );
}
