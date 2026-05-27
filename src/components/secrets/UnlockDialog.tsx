import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSecretsStore } from "../../store/secrets";
import { useT } from "../../i18n";

export function UnlockDialog() {
  const t = useT();
  const needsUnlock = useSecretsStore((s) => s.needsUnlock);
  const unlockWithPassphrase = useSecretsStore((s) => s.unlockWithPassphrase);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    const ok = await unlockWithPassphrase(passphrase);
    setBusy(false);
    if (!ok) {
      setError(t.settings.vault.wrong);
      return;
    }
    setPassphrase("");
  };

  return (
    <Dialog open={needsUnlock}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.settings.vault.unlockTitle}</DialogTitle>
          <DialogDescription>{t.settings.vault.unlockBody}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vault-passphrase">
              {t.settings.vault.enterPassphrase}
            </Label>
            <Input
              id="vault-passphrase"
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={busy}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !passphrase}>
              {t.settings.vault.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
