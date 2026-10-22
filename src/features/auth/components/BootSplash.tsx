import { ActivityIndicator, StyleSheet, View } from 'react-native';

export function BootSplash() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1a3d2e" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f5f0',
  },
});
