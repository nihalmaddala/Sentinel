import React from 'react';
import { Toaster } from 'react-hot-toast';
import DashboardLayout from './components/DashboardLayout';

function App() {
    return (
        <>
            <DashboardLayout />
            <Toaster
                position="top-right"
                toastOptions={{
                    duration: 3000,
                    style: {
                        background: '#18181b',
                        color: '#fafafa',
                        border: '1px solid #3f3f46',
                        fontSize: '12px',
                        fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
                    },
                }}
            />
        </>
    );
}

export default App;
