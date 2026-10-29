import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface ActiveTask {
  id: string;
  title: string;
  startLocation: string;
  endLocation: string;
  status: string;
}

interface TaskState {
  activeTaskId: string | null;
  activeTask: ActiveTask | null;
}

const taskSlice = createSlice({
  name: 'task',
  initialState: {
    activeTaskId: null,
    activeTask: null,
  } as TaskState,
  reducers: {
    setActiveTask(state, action: PayloadAction<ActiveTask | null>) {
      state.activeTask = action.payload;
      state.activeTaskId = action.payload?.id ?? null;
    },
  },
});

export const { setActiveTask } = taskSlice.actions;
export default taskSlice.reducer;
