using System;
using System.Runtime.InteropServices;

internal static class Program
{
    private const int GwlExStyle = -20;
    private const long WsExToolwindow = 0x00000080;
    private const long WsExAppwindow = 0x00040000;
    private const uint SwpNosize = 0x0001;
    private const uint SwpNomove = 0x0002;
    private const uint SwpNozorder = 0x0004;
    private const uint SwpNoactivate = 0x0010;
    private const uint SwpFramechanged = 0x0020;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int cx,
        int cy,
        uint uFlags);

    private static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            return 1;
        }

        long hwndVal;
        if (!long.TryParse(args[0], out hwndVal))
        {
            return 2;
        }

        uint flags = SwpNomove | SwpNosize | SwpNoactivate | SwpFramechanged;
        IntPtr insertAfter = IntPtr.Zero;
        if (args.Length > 1 && args[1] == "bottom")
        {
            insertAfter = new IntPtr(1);
        }
        else
        {
            flags |= SwpNozorder;
        }

        IntPtr hwnd = new IntPtr(hwndVal);
        long ex = GetWindowLongPtr(hwnd, GwlExStyle).ToInt64();
        ex |= WsExToolwindow;
        ex &= ~WsExAppwindow;
        SetWindowLongPtr(hwnd, GwlExStyle, new IntPtr(ex));
        SetWindowPos(hwnd, insertAfter, 0, 0, 0, 0, flags);
        return 0;
    }
}
