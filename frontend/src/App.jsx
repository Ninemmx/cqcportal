import { Route, Routes, BrowserRouter, Navigate } from 'react-router-dom'
import Authentication from './pages/authentication/Authentication'
import { ConfigProvider } from 'antd'
import thTH from 'antd/locale/th_TH'

function App() {
  return (
    <ConfigProvider locale={thTH}>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Authentication />} />
          <Route path="/" element={<Navigate to="/auth" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}

export default App
