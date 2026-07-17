import { useEffect } from "react";

interface UseDisablePrintOptions {
    styleId?: string;
    // buoy fork: skip the print block for links that allow download. A funder
    // whose link permits keeping a copy should be able to print it too;
    // screenshot/watermark-protected links keep the block.
    enabled?: boolean;
}

export function useDisablePrint({
    styleId = "printing-disabled-style",
    enabled = true,
}: UseDisablePrintOptions = {}) {
    useEffect(() => {
        if (!enabled) return;
        // Hide all content unconditionally inside the print media query. This is
        // pure CSS, so it blocks printing / "Save as PDF" even on browsers that
        // do not fire `beforeprint`/`afterprint` or `matchMedia('print')` change
        // events (e.g. Samsung Internet, Opera Mini), without relying on JS to
        // toggle a class at print time.
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
      @media print {
        body {
          display: none !important;
        }
      }
    `;
        document.head.appendChild(style);

        return () => {
            document.getElementById(styleId)?.remove();
        };
    }, [styleId, enabled]);
}
