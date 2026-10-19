import React from 'react';
import { Redirect } from 'expo-router';
import { useSelector } from 'react-redux';
import type { RootState } from '../src/store';

export default function Index() {
  const { isAuthenticated } = useSelector((s: RootState) => s.auth);
  return <Redirect href={isAuthenticated ? '/(tabs)/tasks' : '/login'} />;
}

