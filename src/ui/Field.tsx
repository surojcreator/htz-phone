import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from './theme';

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  keyboard?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  autoCap?: 'none' | 'sentences';
  placeholder?: string;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={[styles.inputWrap, props.error ? { borderColor: theme.bad } : null]}>
        <TextInput
          value={props.value}
          onChangeText={props.onChange}
          secureTextEntry={props.secure && !visible}
          keyboardType={props.keyboard ?? 'default'}
          autoCapitalize={props.autoCap ?? 'none'}
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          spellCheck={false}
          placeholder={props.placeholder}
          placeholderTextColor={theme.dim}
          returnKeyType="done"
          style={styles.input}
        />
        {props.secure && (
          <Pressable onPress={() => setVisible((v) => !v)} hitSlop={10} style={styles.eye}>
            <Text style={styles.eyeText}>{visible ? 'hide' : 'show'}</Text>
          </Pressable>
        )}
      </View>
      {!!props.error && <Text style={styles.errorText}>{props.error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: theme.dim, fontSize: 12, marginBottom: 6, letterSpacing: 0.3 },
  errorText: { color: theme.bad, fontSize: 11.5, marginTop: 5 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingRight: 10,
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: theme.text,
    fontSize: 16,
  },
  eye: { paddingHorizontal: 6, paddingVertical: 4 },
  eyeText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
});
