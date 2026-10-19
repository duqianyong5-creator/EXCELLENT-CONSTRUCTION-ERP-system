import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface NotifState {
  unread: number;
  items: any[];
}

const notifSlice = createSlice({
  name: 'notif',
  initialState: { unread: 0, items: [] } as NotifState,
  reducers: {
    setUnread(state, action: PayloadAction<number>) {
      state.unread = action.payload;
    },
    addNotification(state, action: PayloadAction<any>) {
      state.items.unshift(action.payload);
      state.unread += 1;
    },
    setItems(state, action: PayloadAction<any[]>) {
      state.items = action.payload;
    },
  },
});

export const { setUnread, addNotification, setItems } = notifSlice.actions;
export default notifSlice.reducer;
