import { useState, useEffect } from "react";
import PropTypes from "prop-types";

/**
 * Live countdown to a model-lock expiry.
 *
 * `inline` renders it as a small prefix (used inside the lastError sentence so
 * the countdown reads as part of the message instead of a separate chip).
 * The ⏱ glyph is sized in em so it scales with the surrounding text instead of
 * inheriting a big icon box.
 */
export default function CooldownTimer({ until, inline = false }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const updateRemaining = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("");
        return;
      }
      const secs = Math.floor(diff / 1000);
      if (secs < 60) {
        setRemaining(`${secs}s`);
      } else if (secs < 3600) {
        setRemaining(`${Math.floor(secs / 60)}m ${secs % 60}s`);
      } else {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        setRemaining(`${hrs}h ${mins}m`);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [until]);

  if (!remaining) return null;

  if (inline) {
    return (
      <span className="shrink-0 text-xs text-orange-500 font-mono">
        <span className="text-[0.85em] leading-none">⏱</span> {remaining}
      </span>
    );
  }

  return (
    <span className="text-xs text-orange-500 font-mono">
      <span className="text-[0.85em] leading-none">⏱</span> {remaining}
    </span>
  );
}

CooldownTimer.propTypes = {
  until: PropTypes.string.isRequired,
  inline: PropTypes.bool,
};
