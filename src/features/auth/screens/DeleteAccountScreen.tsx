import { useState } from 'react';
import { router } from 'expo-router';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthScreenShell } from '@/features/auth/components/AuthScreenShell';
import { AuthTextField } from '@/features/auth/components/AuthTextField';
import { useIntentKey } from '@/features/auth/hooks/useIntentKey';
import { requestAccountDeletion } from '@/features/auth/lib/auth-service';
import { authCopy } from '@/features/auth/lib/copy';
import { routes } from '@/features/auth/lib/routes';

export function DeleteAccountScreen() {
  const intent = useIntentKey();
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canDelete = confirmText.trim().toUpperCase() === 'DELETE';

  const handleDelete = async () => {
    setError(null);
    setLoading(true);
    const { error: rpcError } = await requestAccountDeletion({ idempotencyKey: intent.key });
    setLoading(false);

    if (rpcError) {
      const message = rpcError.message ?? '';
      if (message.includes('aal2')) {
        setError(authCopy.aal2Required);
        return;
      }
      setError('Could not schedule deletion. Try again.');
      return;
    }

    router.replace(routes.restoreAccount);
  };

  return (
    <AuthScreenShell
      title={authCopy.deleteTitle}
      subtitle={`${authCopy.deleteBody}\n\n${authCopy.deleteRetention}`}
    >
      <AuthTextField
        label={authCopy.deleteTypePrompt}
        value={confirmText}
        onChangeText={setConfirmText}
        autoCapitalize="characters"
        error={error ?? undefined}
      />
      <AuthButton
        label={authCopy.deleteConfirm}
        variant="danger"
        onPress={() => void handleDelete()}
        loading={loading}
        disabled={!canDelete}
      />
    </AuthScreenShell>
  );
}
