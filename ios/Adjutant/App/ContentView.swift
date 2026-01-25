//
//  ContentView.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-25.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "terminal.fill")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Adjutant")
                .font(.largeTitle)
                .fontWeight(.bold)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
