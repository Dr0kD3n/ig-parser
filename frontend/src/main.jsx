import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { Toaster } from 'react-hot-toast';
import { DialogProvider } from './context/DialogContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DialogProvider>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{ style: { background: '#333', color: '#fff' } }}
      />
    </DialogProvider>
  </React.StrictMode>
);
