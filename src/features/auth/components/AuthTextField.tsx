import { forwardRef } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

type Props = TextInputProps & {
  label: string;
  error?: string;
  /** 'none' while the text changes every second (a countdown); the owner announces it instead. */
  errorLiveRegion?: 'polite' | 'none';
};

export const AuthTextField = forwardRef<TextInput, Props>(function AuthTextField(
  { label, error, errorLiveRegion = 'polite', style, ...props },
  ref,
) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor="#7a8a82"
        accessibilityLabel={label}
        {...props}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion={errorLiveRegion}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: '#1a3d2e', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#c5d4cb',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1a3d2e',
    minHeight: 48,
  },
  inputError: { borderColor: '#b42318' },
  error: { marginTop: 6, color: '#b42318', fontSize: 14, lineHeight: 20 },
});
