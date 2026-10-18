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
  row: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    paddingVertical: 10,
  },
  optionOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  symbol: { fontFamily: fonts.display, fontSize: 18, color: colors.amberDark },
  name: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
  textOn: { color: colors.white },
}));
