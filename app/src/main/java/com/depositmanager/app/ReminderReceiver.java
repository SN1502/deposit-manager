package com.depositmanager.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The reminder alarm went off: post what is due and set the next alarm. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && Reminders.ACTION_FIRE.equals(intent.getAction())) {
            Reminders.fire(context);
        }
    }
}
