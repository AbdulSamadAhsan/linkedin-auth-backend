import mongoose from 'mongoose';

export async function openDatabase(uri) {
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
  });
  const sessionSchema = new mongoose.Schema({
    token_hash: { type: String, required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    expires_at: { type: Date, required: true },
  });
  sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
  const User = connection.model('User', userSchema);
  const Session = connection.model('Session', sessionSchema);
  try { await Promise.all([User.init(), Session.init()]); }
  catch (error) { await connection.close(); throw error; }
  return { User, Session, connection, close: () => connection.close() };
}
