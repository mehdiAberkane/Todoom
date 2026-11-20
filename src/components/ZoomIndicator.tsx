import { useEffect, useState } from "react";
import { useZoom } from "../lib/zoom";

/** Shows the zoom level for a moment after each change. */
export function ZoomIndicator() {
  const { zoom, changes } = useZoom();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!changes) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1200);
    return () => clearTimeout(timer);
  }, [changes]);

  if (!visible) return null;
  return (
    <div className="zoom-indicator" role="status">
      {Math.round(zoom * 100)} %
    </div>
  );
}
