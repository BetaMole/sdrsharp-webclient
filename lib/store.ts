import { create } from "zustand"
import { DirectSampling } from '@jtarrio/webrtlsdr/rtlsdr'

interface SDRState {
  // UI state that's not directly tied to RTL-SDR functionality
  zoom: number
  contrast: {
    min: number
    max: number
  }
  range: {
    min: number
    max: number
  }
  
  // Scanner functionality
  scanner: {
    enabled: boolean
    startFreq: number
    endFreq: number
    stepSize: number
    currentFreq: number
    speed: number
  }
  
  // Bookmarks
  bookmarks: Array<{ name: string; frequency: number; mode: string }>
  
  // Actions
  setZoom: (zoom: number) => void
  setContrast: (min: number, max: number) => void
  setRange: (min: number, max: number) => void
  setScanner: (scanner: Partial<SDRState['scanner']>) => void
  addBookmark: (bookmark: { name: string; frequency: number; mode: string }) => void
  removeBookmark: (index: number) => void
}

export const useSDRStore = create<SDRState>((set) => ({
  // Initial state
  zoom: 1,
  contrast: {
    min: -100,
    max: 0
  },
  range: {
    min: -100,
    max: 0
  },
  
  // Scanner functionality
  scanner: {
    enabled: false,
    startFreq: 88000000,
    endFreq: 108000000,
    stepSize: 100000,
    currentFreq: 88000000,
    speed: 1000,
  },
  
  // Bookmarks
  bookmarks: [
    { name: "FM 91.5", frequency: 91500000, mode: "WBFM" },
    { name: "AM 1010", frequency: 1010000, mode: "AM" },
    { name: "Ham 145.5", frequency: 145500000, mode: "NBFM" },
  ],
  
  // Actions
  setZoom: (zoom) => set({ zoom }),
  setContrast: (min, max) => set({ contrast: { min, max } }),
  setRange: (min, max) => set({ range: { min, max } }),
  setScanner: (scanner) => set((state) => ({ scanner: { ...state.scanner, ...scanner } })),
  addBookmark: (bookmark) => set((state) => ({ bookmarks: [...state.bookmarks, bookmark] })),
  removeBookmark: (index) => set((state) => ({ bookmarks: state.bookmarks.filter((_, i) => i !== index) })),
}))
