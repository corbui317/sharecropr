import { StyleSheet, Text, View } from 'react-native';

/**
 * ODbL attribution — mounted by MapCanvas unconditionally (SPEC-008 R75, NFR-99).
 * Not localised, not abbreviated, not behind a tap target.
 * Positioned by MapCanvas's in-flow attribution strip above the reserved bottom inset (R76), never
 * absolutely and never by z-order. The text is never truncated: no `numberOfLines`, ever.
 */
export function OsmAttribution() {
  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel="Map data from OpenStreetMap contributors"
      testID="map.attribution"
    >
      <Text style={styles.text}>© OpenStreetMap contributors</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 47, 0.15)',
  },
  text: {
    color: '#1e3a2f',
    fontSize: 11,
    fontWeight: '500',
  },
});
