import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 로컬 검토 전용. 외부 배포 설정 없음.
// host: 같은 와이파이의 휴대폰에서도 열 수 있게 모든 네트워크 인터페이스에서 받음(공개 터널·외부 배포 아님). 모든 호스트 허용(allowedHosts)은 켜지 않음
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 },
})
