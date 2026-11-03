import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { PRICE_LEVELS, PriceLevel } from '../lib/price';
import { fonts, radius, spacing, makeStyles } from '../theme';

/**
 * $ / $$ / $$$ side by side. Tap one to pick it, tap it again to clear it.
 * `multi` lets several be on at once (the Price filter in Search); otherwise
 * it's one answer (what a new post cost to make).
 */
export function PricePicker({
  value,
  onChange,
  multi = false,
  testID = 'price',
}: {
  value: PriceLevel[];
  onChange: (levels: PriceLevel[]) => void;
  multi?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const toggle = (level: PriceLevel) => {
    const on = value.includes(level);
    if (multi) onChange(on ? value.filter((l) => l !== level) : [...value, level].sort());
    else onChange(on ? [] : [level]);
  };
  return (
    <View testID={testID} style={styles.row}>
      {PRICE_LEVELS.map((p) => {
        const on = value.includes(p.level);
        return (
          <Pressable
            key={p.level}
            testID={`${testID}-${p.level}`}
            onPress={() => toggle(p.level)}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={multi ? { checked: on } : { selected: on }}
            accessibilityLabel={`${p.symbol}, ${p.name}`}
            style={[styles.option, on && styles.optionOn]}
          >
            <Text style={[styles.symbol, on && styles.textOn]}>{p.symbol}</Text>
            <Text style={[styles.name, on && styles.textOn]}>{p.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Chips, like the meal choice above it: "$ Cheap".
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.creamDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  optionOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  symbol: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.amberDark },
  name: { fontFamily: fonts.semi, fontSize: 14, color: colors.cocoaSoft },
  textOn: { color: colors.onAmber },
}));
