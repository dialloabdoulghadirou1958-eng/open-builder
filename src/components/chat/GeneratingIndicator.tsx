import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "../../i18n";

export function GeneratingIndicator() {
  const t = useT();
  const verbs = t.message.generatingVerbs;
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex(Math.floor(Math.random() * verbs.length));
        setFade(true);
      }, 200);
    }, 2500);
    return () => clearInterval(interval);
  }, [verbs.length]);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
      <Loader2 size={14} className="animate-spin" />
      <span
        className="transition-opacity duration-200"
        style={{ opacity: fade ? 1 : 0 }}
      >
        {verbs[index]}...
      </span>
    </div>
  );
}
