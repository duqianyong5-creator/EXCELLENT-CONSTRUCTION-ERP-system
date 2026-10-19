import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
  token: string | null;
  user: any | null;
  isAuthenticated: boolean;
}

const token = localStorage.getItem('token');
const userStr = localStorage.getItem('user');

let savedUser: any = null;
try {
  savedUser = userStr ? JSON.parse(userStr) : null;
} catch {
  localStorage.removeItem('user');
  localStorage.removeItem('token');
}

const initialState: AuthState = {
  token: savedUser ? token : null,
  user: savedUser,
  isAuthenticated: !!(savedUser && token),
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ token: string; user: any }>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.isAuthenticated = true;
      localStorage.setItem('token', action.payload.token);
      localStorage.setItem('user', JSON.stringify(action.payload.user));
    },
    logout(state) {
      state.token = null;
      state.user = null;
      state.isAuthenticated = false;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    },
    updateUser(state, action: PayloadAction<any>) {
      state.user = { ...state.user, ...action.payload };
      localStorage.setItem('user', JSON.stringify(state.user));
    },
  },
});

export const { setCredentials, logout, updateUser } = authSlice.actions;
export default authSlice.reducer;
